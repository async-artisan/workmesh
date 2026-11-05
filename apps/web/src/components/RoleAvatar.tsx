import { useState } from 'react';

/**
 * 本地角色头像：机器人图片已下载到 `apps/web/public/robots/`，运行时同源加载，
 * 不再请求第三方文生图接口；图片加载失败时回落到首字徽标。
 */
export interface RoleAvatarProps {
  /** 角色 key（lead/product/ui/frontend/...），决定使用哪张本地机器人图片。 */
  role?: string;
  /** 可访问名称（角色中文名）；decorative 时忽略。 */
  label: string;
  /** 与相邻文字重复时标为装饰性，避免读屏重复播报。 */
  decorative?: boolean;
  className?: string;
}

const ROLE_INITIALS: Record<string, string> = {
  lead: '长',
  product: '产',
  ui: '设',
  frontend: '前',
  backend: '后',
  engineering: '研',
  qa: '测',
  ops: '运',
};

/** 已落库的机器人头像（来源：原 text_to_image 生成结果的一次性下载，随仓库分发）。 */
const ROBOT_IMAGES: Record<string, string> = {
  lead: '/robots/lead.jpg',
  product: '/robots/product.jpg',
  ui: '/robots/ui.jpg',
  frontend: '/robots/frontend.jpg',
  backend: '/robots/backend.jpg',
  engineering: '/robots/engineering.jpg',
  qa: '/robots/qa.jpg',
  ops: '/robots/ops.jpg',
};
const DEFAULT_ROBOT = '/robots/assistant.jpg';

/** 有专属配色的角色；其余角色回落到中性色。 */
const ROLE_TONES = new Set(Object.keys(ROLE_INITIALS));

export function RoleAvatar({ role, label, decorative = false, className = '' }: RoleAvatarProps) {
  const key = role ?? '';
  const tone = ROLE_TONES.has(key) ? key : 'default';
  const initial = ROLE_INITIALS[key] ?? (Array.from(label)[0] ?? '?').toUpperCase();
  const [imageFailed, setImageFailed] = useState(false);
  const accessibility = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': label } as const);

  return (
    <span className={`wm-role-avatar is-${tone} ${className}`.trim()} {...accessibility}>
      {imageFailed ? (
        <span className="wm-role-avatar-text">{initial}</span>
      ) : (
        <img
          className="wm-role-avatar-img"
          src={ROBOT_IMAGES[key] ?? DEFAULT_ROBOT}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      )}
    </span>
  );
}
