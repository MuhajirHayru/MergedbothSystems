/**
 * GreenPath design system.
 *
 * One import surface for every screen. Components are token-driven
 * (`bg-card`, `text-muted-foreground`, `border-border`) so light and dark
 * themes work without per-page overrides.
 *
 * Documentation: /design-system
 */

// Buttons and form controls
export { Button, buttonVariants, type ButtonProps } from "./button";
export { Input, inputVariants, type InputProps } from "./input";
export { Textarea, type TextareaProps } from "./textarea";
export { Select, type SelectProps } from "./select";
export { Label, type LabelProps } from "./label";
export { FormField, Field, type FormFieldProps } from "./form-field";

// Status and feedback
export { Badge, badgeVariants, StatusPill, type BadgeProps } from "./badge";
export { Alert, type AlertProps } from "./alert";
export { Toast, ToastContainer, ToastProvider, useToast, type ToastProps } from "./toast";
export { Spinner, PageLoader, ErrorBanner, SuccessBanner } from "./feedback";

// Surfaces and layout
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  type CardProps,
} from "./card";
export { StatCard, Sparkline, type StatCardProps } from "./stat-card";
export { Separator, type SeparatorProps } from "./separator";
export { PageHeader, type PageHeaderProps } from "./page-header";
export { Breadcrumbs, type BreadcrumbsProps, type BreadcrumbItem } from "./breadcrumbs";

// Navigation
export { Tabs, TabsList, TabsTrigger, TabsContent, type TabsProps } from "./tabs";
export { CommandPalette, type CommandItem, type CommandPaletteProps } from "./command-palette";
export {
  DateRangePicker,
  defaultDateRange,
  rangeForPreset,
  type DatePreset,
  type DateRangeValue,
  type DateRangePickerProps,
} from "./date-range";
export { FilterBar, type ActiveFilter, type FilterBarProps } from "./filter-bar";

// Data display
export {
  TableWrap,
  Th,
  Td,
  Pagination,
  DataTable,
  type DataTableColumn,
  type DataTableProps,
} from "./table";
export { ChartCard, type ChartCardProps, type ChartLegendItem } from "./chart-card";

// Overlays
export {
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalContent,
  ModalFooter,
  type ModalProps,
} from "./modal";
export {
  Drawer,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerContent,
  DrawerFooter,
  type DrawerProps,
} from "./drawer";
export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";

// Loading states
export { Skeleton, SkeletonText, SkeletonCard, SkeletonTable } from "./skeleton";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { Avatar, type AvatarProps } from "./avatar";
