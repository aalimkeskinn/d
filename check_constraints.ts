
import fs from 'fs';

const csvPath = '/Users/alim.keskin/Desktop/guncelproje 2 kopyası/dagitimsekli1_v2_guncel.csv';
const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split('\n').filter(l => l.trim().length > 0);

const teacherClassHours: { [key: string]: number } = {};

lines.forEach((line) => {
    const parts = line.split(';');
    if (parts.length < 6) return;
    const teacher = parts[0].trim();
    const level = parts[2].trim();
    const className = parts[4].trim();
    const hours = parseInt(parts[5].trim());

    // Only care about Ortaokul for the 3-hour limit check
    if (level !== 'ORTAOKUL' && level !== 'Ortaokul') return;

    const key = `${teacher} || ${className}`;
    if (!isNaN(hours)) {
        teacherClassHours[key] = (teacherClassHours[key] || 0) + hours;
    }
});

console.log("--- Teacher Weekly Hours Per Class (Ortaokul) ---");
let foundImpossible = false;
Object.entries(teacherClassHours).forEach(([key, load]) => {
    if (load > 15) {
        console.log(`IMPOSSIBLE: ${key} has ${load} hours. (Avg ${load / 5}, needs >3 hours/day)`);
        foundImpossible = true;
    }
});

if (!foundImpossible) {
    console.log("All Ortaokul teacher-class pairs are <= 15 hours. 3-hour daily limit is theoretically possible.");
}
