import { PromoCard } from "./PromoCard";
import { promoCards, PromoCardData } from "./data";

export function PromoGrid({ onAction }: { onAction?: (promo: PromoCardData) => void }) {
  return (
    <div className="grid h-full grid-cols-3 gap-3">
      {promoCards.map((promo) => (
        <PromoCard key={promo.id} {...promo} onAction={() => onAction?.(promo)} />
      ))}
    </div>
  );
}
