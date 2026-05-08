import { motion } from "framer-motion";

export default function GlassCard({ children, className = "" }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.35 }}
      className={`relative overflow-hidden rounded-3xl border border-blue-100 bg-white p-6 shadow-[0_12px_40px_-18px_rgba(37,99,235,0.18)] ${className}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-50/90 via-transparent to-sky-50/70" />
      <div className="relative z-10">{children}</div>
    </motion.section>
  );
}
