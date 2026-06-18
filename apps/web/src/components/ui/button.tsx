// SPDX-FileCopyrightText: 2023 shadcn
//
// SPDX-License-Identifier: MIT

import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-opacity disabled:pointer-events-none disabled:bg-secondary disabled:text-secondary-foreground disabled:border-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground border border-primary hover:opacity-90',
        secondary:
          'bg-secondary text-secondary-foreground border border-border hover:border-ring',
        ghost: 'hover:bg-muted text-foreground',
        outline:
          'border border-input bg-background text-foreground hover:border-ring',
        destructive:
          'bg-destructive text-destructive-foreground border border-destructive hover:opacity-90',
      },
      size: {
        default: 'px-3.5 py-2',
        sm: 'px-3 py-1.5 text-sm',
        lg: 'px-6 py-2.5',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
