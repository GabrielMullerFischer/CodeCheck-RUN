function extrairRolesIsProfessor(roles) {
    if (!Array.isArray(roles)) return false;
    return roles.some(role => {
        const r = String(role || '').toLowerCase();
        return r.includes('instructor') || r.includes('teacher') || r.includes('admin');
    });
}

function construirAuthContext(req, res) {
    const token = res?.locals?.token;
    if (token) {
        const roles = token.platformContext?.roles || [];
        const isProf = extrairRolesIsProfessor(roles);
        const userName = token.userInfo?.name || token.userInfo?.given_name || (isProf ? 'Professor' : 'Aluno');
        const activityId = token.platformContext?.resource?.id || '';

        return {
            userId: token.user || null,
            userName,
            isProfessor: !!isProf,
            activityId: activityId ? String(activityId) : '',
            ltik: res?.locals?.ltik || '',
            fromToken: true
        };
    }

    return {
        userId: req.session?.userId || null,
        userName: req.session?.userName || null,
        isProfessor: req.session?.isProfessor === true,
        activityId: req.session?.activityId ? String(req.session.activityId) : '',
        ltik: '',
        fromToken: false
    };
}

function attachAuthContext(req, res, next) {
    req.auth = construirAuthContext(req, res);
    next();
}

module.exports = {
    extrairRolesIsProfessor,
    construirAuthContext,
    attachAuthContext
};
