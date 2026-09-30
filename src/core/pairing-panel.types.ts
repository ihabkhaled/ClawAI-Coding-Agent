/** Translated text the pairing panel shows. */
export interface PairingPanelLabels {
  readonly title: string;
  readonly instruction: string;
  readonly qrLabel: string;
  readonly linkHeading: string;
  readonly copyLink: string;
  readonly noQr: string;
}

export interface PairingPanelInput {
  readonly url: string;
  readonly nonce: string;
  readonly labels: PairingPanelLabels;
}
