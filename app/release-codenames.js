'use strict';

const RELEASE_CODENAMES = Object.freeze({
	'0.1': 'Misery',
	'0.2': 'Onyx'
});
const RELEASE_QUALIFIERS = Object.freeze({
	'0.2.7': 'Hotfix'
});

function releaseVersion(tag) {
	const match = /^v(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/.exec(tag);
	if (!match)
		throw new Error(`invalid release tag: ${tag}`);
	return {
		line: `${match[1]}.${match[2]}`,
		version: tag.slice(1)
	};
}

function codenameForTag(tag) {
	const { line } = releaseVersion(tag);
	const codename = RELEASE_CODENAMES[line];
	if (!codename)
		throw new Error(`no codename configured for Freenetic ${line}.x`);
	return codename;
}

function releaseTitle(tag) {
	const { version } = releaseVersion(tag);
	const qualifier = RELEASE_QUALIFIERS[version];
	return `Freenetic ${version} — ${codenameForTag(tag)}${qualifier ? ` ${qualifier}` : ''}`;
}

if (require.main === module) {
	try {
		console.log(releaseTitle(process.argv[2] || ''));
	}
	catch (error) {
		console.error(`Cannot create release title: ${error.message}`);
		process.exitCode = 1;
	}
}

module.exports = { RELEASE_CODENAMES, RELEASE_QUALIFIERS, codenameForTag, releaseTitle, releaseVersion };
