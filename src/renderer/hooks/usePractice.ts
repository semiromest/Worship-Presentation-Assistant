import { createContext, useContext } from 'react';
export const PracticeContext = createContext(false);
export const usePractice = () => useContext(PracticeContext);
