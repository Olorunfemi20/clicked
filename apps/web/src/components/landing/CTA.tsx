export function CTA() {
  return (
    <section className="border-t border-[var(--border)]">
      <div className="relative mx-auto max-w-6xl overflow-hidden px-6 py-32 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-[400px] w-[400px] rounded-full bg-[var(--accent)]/10 blur-[100px]" />
        </div>
        <div className="relative z-10">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--foreground)] sm:text-4xl">
            Ready to coordinate on-chain?
          </h2>
          <p className="mt-4 text-[var(--foreground)]/50">
            Connect your Stellar wallet and start building with your community.
          </p>
          <a
            href="/app"
            className="mt-8 inline-flex rounded-full bg-[var(--accent)] px-10 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[var(--accent)]/20 transition-opacity hover:opacity-90"
          >
            Launch App
          </a>
        </div>
      </div>
    </section>
  );
}
