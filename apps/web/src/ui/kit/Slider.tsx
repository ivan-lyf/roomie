import * as RS from '@radix-ui/react-slider';

type Props = {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  /** The value as words, for screen readers: "$2,400". */
  valueText?: string;
};

export function Slider({ label, min, max, step = 1, value, onChange, valueText }: Props) {
  return (
    <RS.Root
      className="relative flex h-6 w-full touch-none items-center select-none"
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={([v]) => v !== undefined && onChange(v)}
    >
      <RS.Track className="relative h-0.5 grow bg-ink">
        <RS.Range className="absolute h-full bg-accent" />
      </RS.Track>
      <RS.Thumb
        aria-label={label}
        aria-valuetext={valueText}
        className="block size-5 rounded-control border-2 border-accent bg-surface"
      />
    </RS.Root>
  );
}
