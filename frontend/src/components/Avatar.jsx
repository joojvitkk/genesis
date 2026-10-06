const SIZES = { xs: 'h-5 w-5 text-xs', sm: 'h-8 w-8 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-12 w-12 text-base', xl: 'h-24 w-24 text-3xl' };

/**
 * Foto do usuário (ver DESIGN_SYSTEM.md): imagem redonda; sem foto, a inicial do nome sobre `sunken`.
 * Decorativa por padrão (o nome já aparece ao lado): `alt=""`.
 */
export default function Avatar({ user, size = 'md', className = '' }) {
  const name = user?.name || user?.username || '?';
  const box = `${SIZES[size] || SIZES.md} shrink-0 rounded-full border border-line ${className}`;
  if (user?.avatar) return <img src={user.avatar} alt="" className={`${box} object-cover`} />;
  return <span aria-hidden="true" className={`${box} flex items-center justify-center bg-sunken font-semibold text-fg`}>{name[0].toUpperCase()}</span>;
}
