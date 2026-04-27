type VisioroLogoImageProps = {
  className?: string;
  alt?: string;
};

export function VisioroLogoImage({
  className = "",
  alt = "Visioro",
}: VisioroLogoImageProps) {
  return <img src="/visioro-logo.png" alt={alt} className={className} />;
}
