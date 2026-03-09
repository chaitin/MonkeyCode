import * as React from "react"
import { Check, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onClick'> {
  checked?: boolean
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
  onClick?: (e: React.MouseEvent) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, indeterminate, onCheckedChange, onClick, ...props }, ref) => {
    const handleClick = (e: React.MouseEvent) => {
      onClick?.(e)
      if (!props.disabled && onCheckedChange) {
        onCheckedChange(!checked)
      }
    }

    return (
      <div className="relative inline-flex items-center" onClick={handleClick}>
        <input
          type="checkbox"
          ref={ref}
          className="peer sr-only"
          checked={checked}
          onChange={(e) => {
            onCheckedChange?.(e.target.checked)
            props.onChange?.(e)
          }}
          {...props}
        />
        <div
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded border-1 transition-colors",
            "peer-checked:bg-primary peer-checked:border-primary",
            "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1",
            "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
            (checked || indeterminate) ? "bg-primary border-primary" : "border-input",
            className
          )}
        >
          {checked && <Check className="h-3 w-3 text-primary-foreground" />}
          {!checked && indeterminate && <Minus className="h-3 w-3 text-primary-foreground" />}
        </div>
      </div>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
