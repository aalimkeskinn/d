import { slugify } from './slugify';

export const getTeacherId = (name: string): string => `teach-${slugify(name)}`;
export const getClassId = (name: string): string => `cls-${slugify(name)}`;
export const getSubjectId = (className: string, teacherNames: string, subjectName: string): string => {
    return `sub-${slugify(`${className}-${teacherNames}-${subjectName}`)}`;
};

/**
 * A highly aggressive cleaning function that handles Turkish characters
 * before stripping everything except a-z and 0-9.
 * This is used for robust ID matching across different formatting versions.
 */
export const ultraClean = (text: string): string => {
    if (!text) return '';
    const trMap: { [key: string]: string } = {
        'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ş': 's', 'Ş': 's',
        'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o', 'ı': 'i', 'İ': 'i'
    };
    let s = text;
    Object.keys(trMap).forEach(key => { s = s.replace(new RegExp(key, 'g'), trMap[key]); });
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * Normalizes an existing ID by removing spaces and applying slugify logic to the parts.
 * Used for backward compatibility with old data that might have had spaces like "teach - name ".
 */
/**
 * Normalizes an existing ID to the standard format.
 * If entityType is provided, it ensures the ID starts with the correct prefix.
 * Handles both plain names and old formatted IDs.
 */
export const normalizeId = (id: string, entityType?: string): string => {
    if (!id) return '';

    let cleanId = id.trim();

    // 1. Remove common prefixes and whitespace if they exist (already handles teach-, cls-, sub-)
    cleanId = cleanId.replace(/^(teach|cls|sub|teacher|class|subject|teachers|classes|subjects)\s*-\s*/, '');

    const slug = slugify(cleanId);

    // 2. Normalize entityType to singular
    const type = entityType?.toLowerCase().replace(/s$/, '');

    // 3. If type is known, enforce it
    if (type === 'teacher') return `teach-${slug}`;
    if (type === 'class') return `cls-${slug}`;
    if (type === 'subject') return `sub-${slug}`;

    // 4. Fallback: try to guess from the original ID if no type provided
    if (id.startsWith('teach')) return `teach-${slug}`;
    if (id.startsWith('cls')) return `cls-${slug}`;
    if (id.startsWith('sub')) return `sub-${slug}`;

    return slug;
};

export const isVirtualClubId = (id: string): boolean => {
    return id.includes('kulup-virtual-') || id.includes('auto-kulup-');
};

export const getGenericClubId = (type: 'teacher' | 'class'): string => {
    return type === 'teacher' ? 'generic-teacher-kulup' : 'generic-class-kulup';
};

export const extractRealIdFromVirtual = (virtualId: string): string => {
    if (virtualId.startsWith('kulup-virtual-teacher-')) {
        return virtualId.replace('kulup-virtual-teacher-', '');
    }
    if (virtualId.startsWith('kulup-virtual-class-')) {
        return virtualId.replace('kulup-virtual-class-', '');
    }
    return virtualId;
};
