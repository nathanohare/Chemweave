import type { PluginCreator } from 'postcss';
declare const colorMixFallback: PluginCreator<void>;
export default colorMixFallback;
export function replaceMixes(value: string, state?: boolean): string;
