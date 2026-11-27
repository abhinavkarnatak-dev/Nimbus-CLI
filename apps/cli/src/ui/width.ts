import { createContext, useContext } from "react";

// One resize listener for the whole app, not one per row
export const WidthContext = createContext(process.stdout.columns || 80);

export function useWidth(): number {
  return useContext(WidthContext);
}
