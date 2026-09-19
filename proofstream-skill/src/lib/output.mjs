export function emit(value, json = false) {
  if (json) console.log(JSON.stringify(value));
  else if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

export function usage() {
  return `ProofStream Integration Skill\n\nCommands:\n  install         install the packaged skill into a project\n  init            detect an agent directory and install locally\n  doctor          verify package integrity and offline consistency\n  docs            discover or locate a reference topic\n  creative-check  validate a brand-safe flyer, banner, social, deck, or motion brief\n  version         print skill and source compatibility\n  help            show this help\n\nUse --json for machine-readable output. Network checks require --network.`;
}
