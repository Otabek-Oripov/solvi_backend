// "Search filters" ekranidan keladigan so'rov parametrlarini bitta shaklga
// keltiradi — /matching/candidates va /users/nearby ikkalasida ham bir xil
// profil maydonlari bo'yicha filtrlash kerak bo'lgani uchun shu yerda.

// "a,b,c" -> ['a','b','c'] (bo'sh/berilmagan bo'lsa undefined)
function parseList(value) {
    if (!value) return undefined;
    return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function parseNum(value) {
    if (value === undefined || value === '') return undefined;
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
}

function parseMatchFilters(q) {
    return {
        gender: q.gender || undefined,
        minAge: parseNum(q.minAge),
        maxAge: parseNum(q.maxAge),
        locationCity: q.locationCity || undefined,
        minHeight: parseNum(q.minHeight),
        maxHeight: parseNum(q.maxHeight),
        minWeight: parseNum(q.minWeight),
        maxWeight: parseNum(q.maxWeight),
        goals: parseList(q.goals),
        educationLevels: parseList(q.educationLevels),
        maritalStatuses: parseList(q.maritalStatuses),
        hasKids: parseList(q.hasKids),
        drinking: parseList(q.drinking),
        smoking: parseList(q.smoking),
        pets: parseList(q.pets),
        religion: parseList(q.religion),
        coreValues: parseList(q.coreValues),
        starSigns: parseList(q.starSigns),
        exercise: parseList(q.exercise),
        languages: parseList(q.languages),
        interests: parseList(q.interests),
    };
}

module.exports = { parseList, parseNum, parseMatchFilters };
