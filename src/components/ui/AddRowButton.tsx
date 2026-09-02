interface AddRowButtonProps {
  label: string
  onClick: () => void
  testId?: string
}

// Dashed full-width row that ends a list ("+ Add account", "+ Add endpoint").
export const AddRowButton = ({ label, onClick, testId }: AddRowButtonProps): JSX.Element => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className="mt-1 flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-border p-2 font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary-soft"
  >
    <span aria-hidden="true">+</span> {label}
  </button>
)
