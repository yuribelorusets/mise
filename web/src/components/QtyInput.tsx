import { useEffect, useId, useState } from "react";
import "./QtyInput.css";

interface Props {
  label: string;
  unit: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function QtyInput({ label, unit, value, onChange, step = 1 }: Props) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));

  // Follow the parent when the value changes from outside (the step buttons).
  useEffect(() => {
    setDraft((d) => (d !== "" && Number(d) === value ? d : String(value)));
  }, [value]);

  const set = (n: number) => onChange(Math.max(0, round(n)));

  return (
    <div className="qty">
      <button type="button" className="qty__btn" aria-label={`Less ${label}`} onClick={() => set(value - step)}>
        <span aria-hidden="true">&minus;</span>
      </button>
      <input
        id={id}
        className="qty__box tnum"
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        aria-label={label}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n) && n >= 0) onChange(n);
        }}
        onBlur={() => setDraft(String(value))}
      />
      <span className="qty__unit" aria-hidden="true">{unit}</span>
      <button type="button" className="qty__btn" aria-label={`More ${label}`} onClick={() => set(value + step)}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
