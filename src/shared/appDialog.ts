export interface AppDialogOptions {
  title: string;
  message: string;
  detail?: string;
  tone?: 'question' | 'info' | 'danger';
  choices: Array<{ value: string; label: string; tone?: 'primary' | 'danger' }>;
}

export interface AppDialogRequest extends AppDialogOptions {
  id: string;
}
