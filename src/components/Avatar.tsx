import { avatarColors, firstChar } from "../lib/format";

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
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
