
import type { SessionStatus } from "../../types/session";
import { STEP_LABELS } from "../../types/session";

const STEPS: SessionStatus[] = ["STEP_1", "STEP_2", "STEP_3", "STEP_4", "STEP_5"];

interface StepHeaderProps {
  currentStep: SessionStatus;
  onBack?: () => void;
}

export function StepHeader({ currentStep, onBack }: StepHeaderProps) {
  const stepIndex = STEPS.indexOf(currentStep);
  const label = STEP_LABELS[currentStep] ?? currentStep;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="text-primary text-sm font-medium px-2 py-1 -ml-2"
          >
            &larr; Back
          </button>
        )}
        <h2 className="text-lg font-semibold text-text">{label}</h2>
        <span className="ml-auto text-xs text-text-secondary">
          Step {stepIndex + 1} of {STEPS.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1.5">
        {STEPS.map((step, i) => (
          <div
            key={step}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= stepIndex ? "bg-primary" : "bg-border"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
