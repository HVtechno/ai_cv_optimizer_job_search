import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

export default function Reveal({ children, delay = 0 }) {
  const ref = useRef();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["0 1", "0.25 1"] });
  const opacity = useTransform(scrollYProgress, [0, 1], [0, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [32, 0]);
  return (
    <motion.div ref={ref} style={{ opacity, y }} transition={{ delay }}>
      {children}
    </motion.div>
  );
}
