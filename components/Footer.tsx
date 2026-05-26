const APP_STORE_URL = 'https://apps.apple.com/us/app/inzone/id6478089068';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.aadeshkheria.inzone&hl=en_US';
const DISCORD_URL = 'https://discord.gg/k3UWyzGmg3';

export function Footer() {
  return (
    <footer className="border-t border-inzone-divider/60 px-4 py-6 dark:border-white/5">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3">
        <p className="text-xs text-inzone-mid-grey">
          Get the InZone mobile app or join our community
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <FooterLink href={APP_STORE_URL} label="App Store">
            <AppleIcon />
          </FooterLink>
          <FooterLink href={PLAY_STORE_URL} label="Google Play">
            <PlayStoreIcon />
          </FooterLink>
          <FooterLink href={DISCORD_URL} label="Discord">
            <DiscordIcon />
          </FooterLink>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-button bg-white px-3 py-2 text-xs font-semibold text-black shadow-card transition hover:bg-inzone-light-grey dark:bg-inzone-dark-surface dark:text-white dark:hover:bg-white/10"
    >
      <span className="flex h-4 w-4 items-center justify-center">{children}</span>
      <span>{label}</span>
    </a>
  );
}

function AppleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.564 12.747c-.027-2.748 2.244-4.07 2.347-4.135-1.279-1.87-3.27-2.128-3.978-2.158-1.692-.171-3.305 1-4.166 1-.876 0-2.188-.975-3.598-.948-1.852.027-3.56 1.075-4.51 2.733-1.92 3.327-.49 8.252 1.385 10.953.917 1.319 2.01 2.8 3.444 2.747 1.385-.056 1.91-.896 3.585-.896 1.673 0 2.146.896 3.612.868 1.494-.028 2.44-1.343 3.355-2.668 1.058-1.531 1.494-3.014 1.521-3.092-.034-.014-2.918-1.119-2.997-4.404zM14.85 4.835c.762-.93 1.279-2.21 1.137-3.49-1.097.046-2.443.732-3.235 1.65-.71.81-1.336 2.114-1.17 3.37 1.226.09 2.486-.61 3.268-1.53z" />
    </svg>
  );
}

function PlayStoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3.609 1.814 13.792 12 3.61 22.186a1.5 1.5 0 0 1-.61-1.21V3.024a1.5 1.5 0 0 1 .61-1.21zm10.89 10.89 2.622 2.622-12.485 7.034 9.863-9.656zm3.732-3.732 2.978 1.677a1.5 1.5 0 0 1 0 2.602l-2.978 1.677-3.04-3.04 3.04-2.916zM4.636 1.156l12.485 7.034-2.622 2.622L4.636 1.156z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}
