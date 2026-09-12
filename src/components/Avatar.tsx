import { useState } from "react";
import { avatarColors, firstChar } from "../lib/format";

interface Props {
  name: string;
  size?: number;
  /** 后端提取的真实图标：base64 编码的 PNG，或完整 data: URI。缺失时回退为字母色块 */
  icon?: string | null;
}

/** 兼容两种契约：裸 base64（后端默认）与已带前缀的 data URI */
function toSrc(icon: string): string {
  return icon.startsWith("data:") ? icon : `data:image/png;base64,${icon}`;
}

export function Avatar({ name, size = 44, icon }: Props) {
  const [broken, setBroken] = useState(false);

  // 真实图标优先；解码失败则退回字母色块，保证列表不会出现破图
  if (icon && !broken) {
    return (
      <img
        src={toSrc(icon)}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-xl object-contain"
        style={{ width: size, height: size }}
      />
    );
  }

  const [c1, c2] = avatarColors(name);
  return (
    <div
      className="avatar shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
      }}
    >
      {firstChar(name)}
    </div>
  );
}
