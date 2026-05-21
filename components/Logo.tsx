export function Logo({ size = 64 }: { size?: number }) {
  return (
    <picture>
      <source srcSet="/dark_icon.png" media="(prefers-color-scheme: dark)" />
      <img
        src="/light_icon.png"
        alt="Inzone"
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    </picture>
  );
}
