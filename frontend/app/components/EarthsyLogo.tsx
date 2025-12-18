"use client";

import Image from "next/image";

type EarthsyLogoProps = {
  variant?: "icon" | "wordmark";
  priority?: boolean;
  className?: string;
};

export default function EarthsyLogo({ variant = "wordmark", priority, className }: EarthsyLogoProps) {
  const src = "/planetory-logo.svg";
  const baseClass = variant === "icon" ? "earthsy-logo-icon" : "earthsy-logo-wordmark";
  const classes = [baseClass, className].filter(Boolean).join(" ");
  const dimensions = variant === "icon" ? { width: 120, height: 120 } : { width: 480, height: 200 };
  const sizes = variant === "icon" ? "120px" : "(min-width: 768px) 480px, 320px";

  return (
    <Image
      src={src}
      alt="Earthsy Logo"
      width={dimensions.width}
      height={dimensions.height}
      sizes={sizes}
      priority={priority}
      className={classes}
    />
  );
}
