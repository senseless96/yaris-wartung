import type { Item } from "../api";
import { dueLine, progress, remainingLine } from "../format";
import { useData } from "../store";
import { Icon, StatusDot } from "../ui";

export function ItemCard({ it, onClick }: { it: Item; onClick?: () => void }) {
  const { dash } = useData();
  const p = dash ? progress(it, dash.odometer.km, dash.today) : null;
  const rem = remainingLine(it);
  return (
    <button className={`item-card st-${it.status}`} onClick={onClick}>
      <StatusDot s={it.status} />
      <div className="item-main">
        <div className="item-name">{it.name}</div>
        <div className="item-due">{dueLine(it)}</div>
        {rem && <div className="item-rem muted">{rem}</div>}
        {p != null && (
          <div className="bar" aria-hidden>
            <span style={{ width: `${Math.round(p * 100)}%` }} />
          </div>
        )}
      </div>
      <span className="chev"><Icon name="chevron" size={18} /></span>
    </button>
  );
}
