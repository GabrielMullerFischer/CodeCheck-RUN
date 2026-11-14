function extrairRolesIsProfessor(roles) {
    if (!Array.isArray(roles)) return false;
    return roles.some(role => {
        const r = String(role || '').toLowerCase();
        return r.includes('instructor') || r.includes('teacher') || r.includes('admin');
    });
}

function sanitizarSegmentoId(val) {
    return String(val || '').trim().replace(/[\/\\\s\.]+/g, '_');
}

function extrairRawActivityId(activityId, courseId) {
    const act = String(activityId || '').trim();
    if (!act) return '';
    const crs = sanitizarSegmentoId(courseId);
    if (crs) {
        const prefixo = `c${crs}_a`;
        if (act.startsWith(prefixo)) {
            return act.slice(prefixo.length);
        }
    }
    const match = act.match(/^c[^_]+_a(.+)$/);
    return match ? match[1] : act;
}

function comporIdentificadorAtividade(rawActivityId, courseId) {
    const act = sanitizarSegmentoId(rawActivityId);
    if (!act || act === 'preview') return act;
    const crs = sanitizarSegmentoId(courseId);
    if (!crs) return act;
    const prefixo = `c${crs}_a`;
    if (act.startsWith(prefixo)) return act;
    return `${prefixo}${act}`;
}

function construirAuthContext(req, res) {
    const token = res?.locals?.token;
    if (token) {
        const roles = token.platformContext?.roles || [];
        const isProf = extrairRolesIsProfessor(roles);
        const userName = token.userInfo?.name || token.userInfo?.given_name || (isProf ? 'Professor' : 'Aluno');
        const rawActivityId = token.platformContext?.resource?.id ? String(token.platformContext.resource.id) : '';
        const courseId = token.platformContext?.context?.id ? String(token.platformContext.context.id) : '';

        const crsSafe = sanitizarSegmentoId(courseId);
        const actSafe = sanitizarSegmentoId(rawActivityId);
        const activityId = comporIdentificadorAtividade(actSafe, crsSafe);

        return {
            userId: token.user || null,
            userName,
            isProfessor: !!isProf,
            activityId: activityId ? String(activityId) : '',
            rawActivityId: actSafe,
            courseId: crsSafe,
            ltik: res?.locals?.ltik || '',
            fromToken: true
        };
    }

    const sessionCrs = req.session?.courseId ? sanitizarSegmentoId(req.session.courseId) : '';
    const sessionActRaw = req.session?.activityId ? String(req.session.activityId) : '';
    const sessionRawAct = req.session?.rawActivityId
        ? sanitizarSegmentoId(req.session.rawActivityId)
        : extrairRawActivityId(sessionActRaw, sessionCrs);
    const sessionAct = sessionRawAct
        ? comporIdentificadorAtividade(sessionRawAct, sessionCrs)
        : sessionActRaw;

    return {
        userId: req.session?.userId || null,
        userName: req.session?.userName || null,
        isProfessor: req.session?.isProfessor === true,
        activityId: sessionAct,
        rawActivityId: sessionRawAct,
        courseId: sessionCrs,
        ltik: '',
        fromToken: false
    };
}

function attachAuthContext(req, res, next) {
    req.auth = construirAuthContext(req, res);
    if (req.session && req.auth.fromToken) {
        req.session.activityId = req.auth.activityId;
        req.session.rawActivityId = req.auth.rawActivityId;
        req.session.courseId = req.auth.courseId;
    }
    next();
}

module.exports = {
    extrairRolesIsProfessor,
    construirAuthContext,
    attachAuthContext,
    comporIdentificadorAtividade,
    extrairRawActivityId
};
