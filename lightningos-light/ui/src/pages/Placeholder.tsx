type PlaceholderProps = {
  title: string
}

export default function Placeholder({ title }: PlaceholderProps) {
  return (
    <section className="section-card space-y-3">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="text-fog/60">This area is reserved for a future release.</p>
      <div className="border border-dashed border-white/20 rounded-2xl p-6 text-fog/50">
        Placeholder content only.
      </div>
    </section>
  )
}
