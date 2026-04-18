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
import time
from datetime import datetime
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
    parser.add_argument("--cloud-type", default="SECURE",
                        choices=["SECURE", "COMMUNITY", "ALL"],
                        help="RunPod cloud pool (default: SECURE)")
    parser.add_argument("--no-public-ip", action="store_true",
                        help="Don't require a public IP (needed for most COMMUNITY hosts)")
    parser.add_argument("--image", help="Docker image (overrides DOCKER_IMAGE in .env)")
    parser.add_argument("--name", help="Pod name")
    parser.add_argument("--volume-gb", type=int, default=40)
    parser.add_argument("--disk-gb",   type=int, default=20)
    parser.add_argument("--list-gpus", action="store_true")
    parser.add_argument("--retry-until-available", action="store_true",
                        help="Poll until capacity is available (Ctrl+C to abort)")
    parser.add_argument("--retry-interval", type=int, default=60,
                        help="Seconds between retries (default: 60)")
    parser.add_argument("--debug", action="store_true",
                        help="Print the GraphQL mutation and availability query result before deploying")
    parser.add_argument("--keep-alive-on-error", action="store_true",
                        help="If training or upload fails, keep the pod alive for SSH debugging "
                             "(skips auto-terminate; you pay until you stop it manually)")
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

    if args.keep_alive_on_error:
        container_env["KEEP_ALIVE_ON_ERROR"] = "1"

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

    support_public_ip = not args.no_public_ip

    print(f"\n[launch] Launching pod: {pod_name}")
    print(f"  Image:      {image}")
    print(f"  GPU:        {args.gpu}")
    print(f"  Cloud:      {args.cloud_type}")
    print(f"  Public IP:  {support_public_ip}")
    print(f"  Config:     {args.config}")
    if starting_checkpoint:
        print(f"  Ckpt:       {starting_checkpoint}")
    print(f"  Disk:       {args.disk_gb} GB container / {args.volume_gb} GB volume")
    print(f"  S3:         s3://{os.environ['S3_BUCKET']}/cw-model/runs/")
    print(f"  S3 endpoint:  {container_env.get('S3_ENDPOINT_URL', '<NOT SET>')}")
    print(f"  AWS key ID:   {container_env.get('AWS_ACCESS_KEY_ID', '<NOT SET>')}")
    print(f"  Env vars passed: {list(container_env.keys())}")
    print()

    create_kwargs = dict(
        name=pod_name,
        image_name=image,
        gpu_type_id=args.gpu,
        cloud_type=args.cloud_type,
        support_public_ip=support_public_ip,
        env=container_env,
        container_disk_in_gb=args.disk_gb,
        volume_in_gb=args.volume_gb,
    )
    # Only set volume_mount_path when a volume is actually requested; passing
    # it with volume_in_gb=0 is inconsistent and excludes hosts.
    if args.volume_gb > 0:
        create_kwargs["volume_mount_path"] = "/workspace"

    if args.debug:
        from runpod.api import ctl_commands as _ctl
        from runpod.api.graphql import run_graphql_query as _gql
        from runpod.api.queries import gpus as _gpu_q
        print("\n--- [debug] GPU availability probe ---")
        try:
            q = _gpu_q.generate_gpu_query(args.gpu, gpu_count=1)
            resp = _gql(q)
            print(resp)
        except Exception as e:
            print(f"gpu query failed: {e}")
        print("\n--- [debug] GraphQL mutation about to be sent ---")
        redacted_env = {k: "<REDACTED>" for k in create_kwargs["env"]}
        mut = _ctl.pod_mutations.generate_pod_deployment_mutation(
            create_kwargs["name"],
            create_kwargs["image_name"],
            create_kwargs["gpu_type_id"],
            create_kwargs["cloud_type"],
            create_kwargs["support_public_ip"],
            True,  # start_ssh default
            None, None,  # data_center_id, country_code
            1,  # gpu_count
            create_kwargs["volume_in_gb"],
            create_kwargs["container_disk_in_gb"],
            1, 1,  # min_vcpu_count, min_memory_in_gb
            "", None,  # docker_args, ports
            create_kwargs.get("volume_mount_path"),
            redacted_env,
            None, None, None, None, None, None,
        )
        print(mut)
        print("--- [debug] end ---\n")

    attempt = 0
    while True:
        attempt += 1
        try:
            pod = runpod.create_pod(**create_kwargs)
            break
        except Exception as e:
            msg = str(e)
            transient = "does not have the resources" in msg or "no longer any instances" in msg
            if not (args.retry_until_available and transient):
                raise
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"[{ts}] attempt {attempt}: no capacity — retrying in {args.retry_interval}s "
                  f"(Ctrl+C to abort)", flush=True)
            time.sleep(args.retry_interval)

    pod_id = pod.get("id") or pod.get("podId") or str(pod)
    print(f"[launch] Pod started: {pod_id}")
    print(f"  Dashboard: https://console.runpod.io/pods?id={pod_id}")
    print(f"\n  Artifacts will upload to: s3://{os.environ['S3_BUCKET']}/cw-model/runs/")


if __name__ == "__main__":
    main()
