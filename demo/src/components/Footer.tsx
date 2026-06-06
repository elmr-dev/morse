import { Heart } from 'lucide-react'
import pkg from '../../package.json'

export default function Footer() {
  return (
    <footer>
      <div className="max-w-[900px] mx-auto px-5 py-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          Made with
          <Heart className="size-3.5 text-chart-5 fill-chart-5" aria-label="love" />
          in Atlanta
        </span>
        <span aria-hidden="true">&middot;</span>
        <span className="font-mono">v{pkg.version}</span>
      </div>
    </footer>
  )
}
