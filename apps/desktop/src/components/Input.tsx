import { forwardRef, type InputHTMLAttributes } from "react";

const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...props }, ref) {
  return (
    <input ref={ref} className={`ui-input ${className}`.trim()} {...props} />
  );
});

interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  onClear?: () => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput({ onClear, onKeyDown, ...props }, ref) {
    return (
      <Input
        ref={ref}
        type="search"
        className="search-input"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClear?.();
          onKeyDown?.(event);
        }}
        {...props}
      />
    );
  },
);
