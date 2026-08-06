import { ShieldCheckmark20Regular, Link20Regular, FolderArrowRight20Regular, Warning20Filled, Code20Filled } from "@fluentui/react-icons";

export function AboutView() {
  return (
    <div className="animate-fade-in max-w-2xl">
      {/* 开发者信息 */}
      <div className="card p-5 mb-8 flex items-center gap-4">
        <img
          src="/Pic/H/Image_1785656219137_257.jpg"
          alt="0x7c14"
          className="w-20 h-20 rounded-2xl object-cover ring-2 ring-white dark:ring-white/10 shadow-soft shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold ink-primary">0x7c14</h2>
            <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <Code20Filled />
              Developer
            </span>
          </div>
          <p className="text-sm ink-secondary mt-1.5 leading-relaxed">
            ACG & Tech
          </p>
          <p className="text-xs ink-soft mt-1">
            FolderMove-Plus 是我在学习过程中做的一个小工具，希望能帮你减轻 C 盘的压力。
          </p>
        </div>
      </div>

      <h2 className="text-lg font-semibold ink-primary mb-1">FolderMove-Plus 是什么</h2>
      <p className="text-sm ink-secondary leading-relaxed mb-6">
        FolderMove-Plus 利用 NTFS 文件系统的<strong className="ink-primary"> 目录联接 (Junction)</strong> 特性，
        把已安装软件的真实文件搬到其他盘，再在原位置留下一个指向新位置的"快捷入口"。
        对软件和系统而言路径完全没变，照常运行，但 C 盘空间被真正释放。
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <Feature Icon={FolderArrowRight20Regular} title="原位搬迁" desc="文件移走，路径不变" />
        <Feature Icon={Link20Regular} title="Junction 链接" desc="原生 NTFS 特性，零性能损耗" />
        <Feature Icon={ShieldCheckmark20Regular} title="可随时还原" desc="记录在册，一键回迁" />
      </div>

      <h3 className="text-sm font-semibold ink-primary mb-2">工作流程</h3>
      <ol className="text-sm ink-secondary space-y-1.5 mb-8 list-decimal list-inside">
        <li>扫描注册表的卸载项，获取控制面板同口径的已安装软件及安装目录。</li>
        <li>用 <code className="ink-primary bg-panel-soft dark:bg-white/10 px-1.5 py-0.5 rounded">robocopy</code> 把目录完整复制到目标盘（保留权限与时间戳）。</li>
        <li>校验完整性后，把原目录重命名为备份，在原位创建 Junction 指向新位置。</li>
        <li>校验链接可用后，删除备份，释放原盘空间。整个过程可一键还原。</li>
      </ol>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 dark:bg-amber-500/10 dark:border-amber-500/30">
        <Warning20Filled className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
          <strong>使用建议：</strong>移动前请先<strong>完全退出</strong>目标软件（包括托盘与后台进程），
          否则文件被占用会导致复制或重命名失败。<strong>高风险</strong>评级的项目涉及系统关键目录，
          移动后可能影响系统稳定性，请谨慎操作。重要数据建议先备份。
        </div>
      </div>
    </div>
  );
}

function Feature({
  Icon,
  title,
  desc,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="card p-4">
      <div className="w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-500/15 flex items-center justify-center mb-2">
        <Icon className="text-brand-600 dark:text-brand-400" />
      </div>
      <div className="text-sm font-medium ink-primary">{title}</div>
      <div className="text-xs ink-soft mt-0.5">{desc}</div>
    </div>
  );
}
