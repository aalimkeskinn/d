/**
 * Metni Türkçe karakterleri de destekleyen güvenli bir URL/ID dostu hale çevirir.
 */
export const slugify = (text: string): string => {
    if (!text) return '';

    const trMap: { [key: string]: string } = {
        'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ş': 's', 'Ş': 's',
        'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o', 'ı': 'i', 'İ': 'i'
    };

    let sanitized = text;
    Object.keys(trMap).forEach(key => {
        sanitized = sanitized.replace(new RegExp(key, 'g'), trMap[key]);
    });

    return sanitized
        .toLowerCase()
        .replace(/\s+/g, '-') // Spaces to hyphens
        .replace(/[^a-z0-9-]/g, '') // Keep alphanumeric and hyphens
        .replace(/-+/g, '-') // Collapse multiple hyphens
        .replace(/^-+|-+$/g, '') // Trim hyphens
        .trim();
};
