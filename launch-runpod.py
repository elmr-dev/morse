#!/usr/bin/env python3
"""
Launch a CW model training job on RunPod.

Usage:
  python launch-runpod.py --config configs/base.yaml
  python launch-runpod.py --config configs/base.yaml --gpu "RTX 4090" --image myrepo/cw-model:latest

Reads credentials from .env (in morse/ dir or cwd):
  RUNPOD_API_KEY        RunPod API key
  DOCKER_IMAGE          Docker image (e.g. docker.io/you/cw-model:latest)
  S3_BUCKET             Bucket name (e.g. ml-runs)
  S3_ENDPOINT_URL       Cloudflare R2 endpoint URL
  AWS_ACCESS_KEY_ID     R2 / S3 access key
  AWS_SECRET_ACCESS_KEY R2 / S3 secret key
  AWS_DEFAULT_REGION    Optional; set to "auto" for R2
"""

import argparse
import os
import sys
from pathlib import Path


def load_env():
    try:
        from dotenv import load_dotenv
    except ImportError:
        sys.exit("ERROR: pip install python-dotenv")

    # Search: script dir, parent (cw-ml), grandparent (morse), cwd
    candidates = [
        Path(__file__).parent / ".env",
        Path(__file__).parent.parent / ".env",
        Path(__file__).parent.parent.parent / ".env",
        Path.cwd() / ".env",
    ]
    for p in candidates:
        if p.exists():
            load_dotenv(p)
            print(f"[launch] Loaded {p}")
            return
    print("[launch] Warning: no .env found — using existing environment variables")


def get_runpod():
    try:
        import runpod
        return runpod
    except ImportError:
        sys.exit("ERROR: pip install runpod")


def main():
    parser = argparse.ArgumentParser(description="Launch CW model training on RunPod")
    parser.add_argument("--config", required=True,
                        help="Config path inside container, e.g. configs/base.yaml")
    parser.add_argument("--starting-checkpoint",
                        help="Checkpoint path inside container")
    parser.add_argument("--no-checkpoint", action="store_true",
                        help="Train from scratch, ignore checkpoints/base.pt")
    parser.add_argument("--gpu", default="NVIDIA GeForce RTX 4090",
                        help='GPU type (default: "NVIDIA GeForce RTX 4090")')
    parser.add_argument("--image", help="Docker image (overrides DOCKER_IMAGE in .env)")
    parser.add_argument("--name", help="Pod name")
    parser.add_argument("--volume-gb", type=int, default=40)
    parser.add_argument("--disk-gb",   type=int, default=20)
    parser.add_argument("--list-gpus", action="store_true")
    args = parser.parse_args()

    load_env()

    required = ["RUNPOD_API_KEY", "S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        sys.exit(f"ERROR: Missing required env vars: {', '.join(missing)}")

    image = args.image or os.environ.get("DOCKER_IMAGE")
    if not image:
        sys.exit("ERROR: Docker image required — pass --image or set DOCKER_IMAGE in .env")

    starting_checkpoint = None
    if args.no_checkpoint:
        print("[launch] --no-checkpoint: training from scratch")
    elif args.starting_checkpoint:
        starting_checkpoint = args.starting_checkpoint
    elif Path("checkpoints/base.pt").exists():
        starting_checkpoint = "/app/checkpoints/base.pt"
        print(f"[launch] Auto-using checkpoint: {starting_checkpoint}")

    run_cmd = f"pipeline --config {args.config}"
    if starting_checkpoint:
        run_cmd += f" --starting-checkpoint {starting_checkpoint}"

    container_env = {
        "RUN_CMD":               run_cmd,
        "RUNPOD_API_KEY":        os.environ["RUNPOD_API_KEY"],
        "S3_BUCKET":             os.environ["S3_BUCKET"],
        "AWS_ACCESS_KEY_ID":     os.environ["AWS_ACCESS_KEY_ID"],
        "AWS_SECRET_ACCESS_KEY": os.environ["AWS_SECRET_ACCESS_KEY"],
    }
    for optional in ("S3_ENDPOINT_URL", "AWS_DEFAULT_REGION"):
        if os.environ.get(optional):
            container_env[optional] = os.environ[optional]

    config_stem = Path(args.config).stem
    pod_name = args.name or f"cw-model-{config_stem}"

    runpod = get_runpod()
    runpod.api_key = os.environ["RUNPOD_API_KEY"]

    if args.list_gpus:
        gpus = runpod.get_gpus()
        print(f"{'ID':<40} {'Display Name'}")
        print("-" * 60)
        for g in gpus:
            print(f"{g['id']:<40} {g['displayName']}")
        sys.exit(0)

    print(f"\n[launch] Launching pod: {pod_name}")
    print(f"  Image:   {image}")
    print(f"  GPU:     {args.gpu}")
    print(f"  Config:  {args.config}")
    if starting_checkpoint:
        print(f"  Ckpt:    {starting_checkpoint}")
    print(f"  Volume:  {args.volume_gb} GB")
    print(f"  S3:      s3://{os.environ['S3_BUCKET']}/cw-model/runs/")
    print()

    pod = runpod.create_pod(
        name=pod_name,
        image_name=image,
        gpu_type_id=args.gpu,
        cloud_type="SECURE",
        env=container_env,
        container_disk_in_gb=args.disk_gb,
        volume_in_gb=args.volume_gb,
        volume_mount_path="/workspace",
    )

    pod_id = pod.get("id") or pod.get("podId") or str(pod)
    print(f"[launch] Pod started: {pod_id}")
    print(f"  Dashboard: https://www.runpod.io/console/pods/{pod_id}")
    print(f"\n  Artifacts will upload to: s3://{os.environ['S3_BUCKET']}/cw-model/runs/")


if __name__ == "__main__":
    main()
