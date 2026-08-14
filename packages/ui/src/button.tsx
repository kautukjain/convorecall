import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export function Button({ children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} {...rest}>
      {children}
    </button>
  );
}
