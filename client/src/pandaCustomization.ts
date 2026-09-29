import { useEffect, useState } from "react";

export type PandaGlasses = "none" | "classic" | "money";

export type PandaCustomization = {
  glasses: PandaGlasses;
};

export const defaultPandaCustomization: PandaCustomization = {
  glasses: "none",
};

const storageKey = "panda-customization";
const glasses = new Set<PandaGlasses>(["none", "classic", "money"]);

function readPandaCustomization(): PandaCustomization {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return {
      glasses: glasses.has(saved.glasses)
        ? saved.glasses
        : defaultPandaCustomization.glasses,
    };
  } catch {
    return defaultPandaCustomization;
  }
}

export function savePandaCustomization(value: PandaCustomization) {
  localStorage.setItem(storageKey, JSON.stringify(value));
  window.dispatchEvent(new Event("panda-customization"));
}

export function usePandaCustomization() {
  const [value, setValue] = useState(readPandaCustomization);
  useEffect(() => {
    const update = () => setValue(readPandaCustomization());
    window.addEventListener("storage", update);
    window.addEventListener("panda-customization", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("panda-customization", update);
    };
  }, []);
  return value;
}
