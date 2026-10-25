import warwickLogo from '../../assets/warwick-institute-logo.png';

export function WarwickInstituteLogo({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      aria-label="Warwick Institute"
      viewBox="69 63 572 142"
      width={572}
      height={142}
      className={className}
    >
      {/* Crop the asset's transparent margins without changing the original logo. */}
      <image href={warwickLogo} width={700} height={268} />
    </svg>
  );
}
