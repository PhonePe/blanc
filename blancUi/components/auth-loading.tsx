"use client"

import { motion } from "framer-motion"
import { ShieldAlert } from "lucide-react"

export function AuthLoading() {
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-card">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center gap-4"
      >
        <motion.div
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="flex items-center justify-center size-16 rounded-2xl bg-primary text-primary-foreground shadow-xl"
        >
          <ShieldAlert className="size-8" />
        </motion.div>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">ATM Threat Engine</p>
          <p className="text-xs text-muted-foreground mt-1">Verifying your session...</p>
        </div>
        <motion.div
          className="h-1 w-32 rounded-full bg-muted overflow-hidden"
        >
          <motion.div
            className="h-full bg-foreground rounded-full"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      </motion.div>
    </div>
  )
}
