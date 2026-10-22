import Image from "next/image";
import { HERMES_AVATAR } from "@/lib/hermes-brand.mjs";

export function HermesAvatar({ size, priority = false, className = "" }: { size: number; priority?: boolean; className?: string }) {
  return <Image src={HERMES_AVATAR} width={size} height={size} alt="" aria-hidden="true" priority={priority} className={`hermes-avatar ${className}`} />;
}
