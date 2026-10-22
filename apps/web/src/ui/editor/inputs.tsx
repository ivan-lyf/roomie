import { INCH } from '@roomie/geometry';
import { useState } from 'react';
import { formatLength, parseLength } from '../../format';

/**
 * A length the user can type in any unit (`12'4"`, `3.6 m`, `360 cm`): shown in the plan's unit,
 * applied on Enter or leaving the field, and put back if it can't be read.
 */
export function LengthInput(props: {
  value: number | undefined;
  imperial: boolean;
  onChange: (meters: number) => void;
  placeholder?: string;
  /** Show centimeters or inches: for thicknesses. */
  precise?: boolean;
  className?: string;
}) {
  const { value, imperial, onChange, precise } = props;
  const shown = value === undefined ? '' : format(value, imperial, precise);
  const [text, setText] = useState<string>();
  const commit = () => {
    if (text === undefined) return;
    const meters = text.trim() === '' ? undefined : read(text, imperial, precise);
    setText(undefined);
    if (meters !== undefined && meters > 0) onChange(meters);
  };
  return (
    <input
      type="text"
      value={text ?? shown}
      placeholder={props.placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setText(undefined);
      }}
      className={
        props.className ?? 'w-full rounded border border-stone-300 px-2 py-1 text-sm text-stone-800'
      }
    />
  );
}

/** Thicknesses read better in inches or centimeters. */
function format(meters: number, imperial: boolean, precise?: boolean) {
  if (!precise) return formatLength(meters, imperial);
  return imperial ? `${+(meters / INCH).toFixed(1)}″` : `${+(meters * 100).toFixed(1)} cm`;
}

function read(text: string, imperial: boolean, precise?: boolean) {
  const bare = /^\d+(?:[.,]\d+)?$/.test(text.trim());
  if (precise && bare) {
    const n = Number(text.trim().replace(',', '.'));
    return imperial ? n * INCH : n / 100;
  }
  return parseLength(text, imperial);
}
