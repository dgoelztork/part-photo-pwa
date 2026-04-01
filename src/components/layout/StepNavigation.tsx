import type { ReactNode } from "react";

interface StepNavigationProps {
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  children?: ReactNode;
}

export function StepNavigation({
  onNext,
  nextLabel = "Next",
  nextDisabled = false,
  children,
}: StepNavigationProps) {
  return (
    <div className="mt-auto pt-4 flex flex-col gap-2">
      {children}
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className="w-full py-4 rounded-xl bg-primary text-white font-semibold text-lg
                   disabled:opacity-40 active:scale-[0.98] transition-transform"
      >
        {nextLabel}
      </button>
    </div>
  );
}
