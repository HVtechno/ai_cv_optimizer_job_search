import { useState, useEffect, useRef } from "react";

export default function Speedometer({ value }) {
  const [animatedValue, setAnimatedValue] = useState(0);
  const frameRef = useRef(null);

  const radius = 70;
  const stroke = 12;
  const circumference = Math.PI * radius;

  useEffect(() => {
    const start = animatedValue;
    const end = value;
    const duration = 700;
    let startTime = null;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * eased;
      setAnimatedValue(current);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value]);

  const progress = animatedValue / 100;
  const offset = circumference - progress * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="100" viewBox="0 0 200 120">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#374151" strokeWidth={stroke} strokeLinecap="round" />
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#22c55e" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} />
        <text x="100" y="100" textAnchor="middle" fontSize="32" fontWeight="bold" fill="white">
          {Math.round(animatedValue)}%
        </text>
      </svg>
    </div>
  );
}
