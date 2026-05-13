export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-[var(--foreground)]/40 sm:flex-row">
        <span>
          clicked<span className="text-[var(--accent)]">.</span> — Web3 Social Messaging
        </span>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/codebestia/clicked"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--foreground)] transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://stellar.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--foreground)] transition-colors"
          >
            Stellar
          </a>
          <span>MIT License</span>
        </div>
      </div>
    </footer>
  );
}
