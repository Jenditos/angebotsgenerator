import { VisioroLogoImage } from "@/components/VisioroLogoImage";

type VisioroLogoPillProps = {
  className?: string;
};

export function VisioroLogoPill({ className = "" }: VisioroLogoPillProps) {
  const logoClassName = className
    ? `pill topHeaderLogo ${className}`
    : "pill topHeaderLogo";

  return (
    <span className={logoClassName} aria-label="Visioro">
      <VisioroLogoImage className="topHeaderLogoImage" />
    </span>
  );
}
