import { useId, type ComponentProps } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

// shadcn/ui Radix Select composition, styled with Lanvory's existing CSS tokens.
type SelectOption = { value: string; label: string; disabled?: boolean };

type SelectFieldProps = Pick<ComponentProps<typeof SelectPrimitive.Root>,
  'name' | 'value' | 'defaultValue' | 'onValueChange' | 'required' | 'disabled'> & {
  label: string;
  options: readonly SelectOption[];
  placeholder?: string;
};

export function SelectField({ label, options, placeholder = 'Select an option', ...root }: SelectFieldProps) {
  const id = useId();

  return (
    <div className="select-field">
      <label htmlFor={id}>{label}</label>
      <SelectPrimitive.Root {...root}>
        <SelectPrimitive.Trigger id={id} className="shadcn-select-trigger" data-field={root.name}>
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon asChild><ChevronDown size={16} aria-hidden="true" /></SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className="shadcn-select-content" position="popper" sideOffset={5} collisionPadding={10}>
            <SelectPrimitive.ScrollUpButton className="shadcn-select-scroll"><ChevronUp size={16} /></SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="shadcn-select-viewport">
              <SelectPrimitive.Group>
                {options.map(({ value, label: text, disabled }) => (
                  <SelectPrimitive.Item value={value} key={value} disabled={disabled} className="shadcn-select-item">
                    <SelectPrimitive.ItemText>{text}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="shadcn-select-indicator"><Check size={15} /></SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Group>
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="shadcn-select-scroll"><ChevronDown size={16} /></SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}

export const accessDurations = [
  { value: 'until-revoked', label: 'Until revoked' },
  { value: 'hour', label: '1 hour' },
  { value: 'day', label: '24 hours' },
] as const;
