"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Copiar un valor al portapapeles, con acuse de recibo.
 *
 * Vivía dentro de `McpConnectorSection`. Se extrajo cuando la sección del Atajo
 * de iOS necesitó lo mismo: copiarlo era la forma garantizada de que dentro de
 * unos meses "Copiar" se viera y se comportara distinto según de qué tarjeta lo
 * tocaras.
 *
 * El cambio de texto a "¡Copiado!" no es decoración: `navigator.clipboard`
 * no da ninguna señal visible, y un botón que no acusa recibo se toca tres
 * veces.
 */
export function CopyButton({ value, label = "Copiar", className }: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
      {copied ? "¡Copiado!" : label}
    </Button>
  );
}
