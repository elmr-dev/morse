"""
Immutable 2-state Bayesian HMM for P(tone_on) estimation.
Uses Beta emissions (proper [0,1] bounded model) with forward-backward.
The agent must not edit this file.
"""
import numpy as np
from scipy.special import logsumexp, betaln


class CWBayesianHMM:
    """
    Two-state HMM: OFF (0) and ON (1).

    Emissions: Beta distribution per channel per state.
    Transitions: Initialized from CW timing priors at 500 Hz.

    After construction, call fit() on labeled training data,
    then decode() on new envelopes to get P(tone_on).
    """

    def __init__(self, n_channels, env_sr=500):
        self.n_channels = n_channels
        self.sr = env_sr

        # Transition priors: assume ~25 WPM average
        # dit = 48ms = 24 samples at 500 Hz
        # Minimum element: ~20 samples on, ~10 samples off
        p_stay_on = 0.96    # 1 - 1/25
        p_stay_off = 0.92   # 1 - 1/12 (shorter gaps on average)

        self.log_trans = np.log(np.array([
            [p_stay_off, 1 - p_stay_off],   # OFF → OFF, OFF → ON
            [1 - p_stay_on, p_stay_on],      # ON → OFF, ON → ON
        ]))

        self.log_startprob = np.log(np.array([0.7, 0.3]))

        # Beta emission params: (alpha, beta) per state per channel
        # OFF state: low values → Beta(2, 8) peaked near 0.2
        # ON state: high values → Beta(8, 2) peaked near 0.8
        self.alpha = np.zeros((2, n_channels))
        self.beta_param = np.zeros((2, n_channels))

        for c in range(n_channels):
            self.alpha[0, c] = 2.0   # OFF
            self.beta_param[0, c] = 8.0
            self.alpha[1, c] = 8.0   # ON
            self.beta_param[1, c] = 2.0

    def fit(self, envelopes_list, labels_list, n_iter=10):
        """
        EM fitting on labeled data.
        envelopes_list: list of (T, C) arrays
        labels_list: list of (T,) binary arrays
        """
        # Supervised fit: just compute Beta MLE from labeled segments
        on_vals = [[] for _ in range(self.n_channels)]
        off_vals = [[] for _ in range(self.n_channels)]

        for env, lab in zip(envelopes_list, labels_list):
            C = min(env.shape[1], self.n_channels)
            for c in range(C):
                on_vals[c].append(env[lab == 1, c])
                off_vals[c].append(env[lab == 0, c])

        for c in range(self.n_channels):
            on = np.clip(np.concatenate(on_vals[c]), 0.001, 0.999)
            off = np.clip(np.concatenate(off_vals[c]), 0.001, 0.999)

            if len(on) > 10:
                a, b = self._beta_mle(on)
                self.alpha[1, c], self.beta_param[1, c] = a, b
            if len(off) > 10:
                a, b = self._beta_mle(off)
                self.alpha[0, c], self.beta_param[0, c] = a, b

        # Fit transition probs from labeled data
        n_off_off = n_off_on = n_on_off = n_on_on = 0
        for lab in labels_list:
            for t in range(1, len(lab)):
                if lab[t-1] == 0 and lab[t] == 0: n_off_off += 1
                elif lab[t-1] == 0 and lab[t] == 1: n_off_on += 1
                elif lab[t-1] == 1 and lab[t] == 0: n_on_off += 1
                else: n_on_on += 1

        if n_off_off + n_off_on > 0:
            p00 = n_off_off / (n_off_off + n_off_on)
            self.log_trans[0] = np.log([max(p00, 0.01), max(1-p00, 0.01)])
        if n_on_on + n_on_off > 0:
            p11 = n_on_on / (n_on_on + n_on_off)
            self.log_trans[1] = np.log([max(1-p11, 0.01), max(p11, 0.01)])

    def decode(self, envelope):
        """
        Forward-backward on (T, C) envelope.
        Returns P(tone_on | all observations) at each timestep.
        """
        T = envelope.shape[0]
        C = min(envelope.shape[1], self.n_channels)
        env = np.clip(envelope[:, :C], 0.001, 0.999)

        # Log emission probs: sum of Beta log-pdf across channels
        log_B = np.zeros((T, 2))
        for s in range(2):
            for c in range(C):
                a = self.alpha[s, c]
                b = self.beta_param[s, c]
                log_B[:, s] += (
                    (a - 1) * np.log(env[:, c]) +
                    (b - 1) * np.log(1 - env[:, c]) -
                    betaln(a, b)
                )

        # Forward
        log_alpha = np.zeros((T, 2))
        log_alpha[0] = self.log_startprob + log_B[0]
        for t in range(1, T):
            for j in range(2):
                log_alpha[t, j] = (
                    logsumexp(log_alpha[t-1] + self.log_trans[:, j]) +
                    log_B[t, j]
                )

        # Backward
        log_beta = np.zeros((T, 2))
        for t in range(T - 2, -1, -1):
            for i in range(2):
                log_beta[t, i] = logsumexp(
                    self.log_trans[i, :] + log_B[t+1] + log_beta[t+1]
                )

        # Posterior
        log_gamma = log_alpha + log_beta
        log_gamma -= logsumexp(log_gamma, axis=1, keepdims=True)

        return np.exp(log_gamma[:, 1])  # P(ON)

    @staticmethod
    def _beta_mle(x):
        """Method of moments Beta MLE."""
        m = np.mean(x)
        v = np.var(x)
        if v >= m * (1 - m):
            v = m * (1 - m) * 0.9  # clamp
        common = m * (1 - m) / v - 1
        return max(m * common, 0.5), max((1 - m) * common, 0.5)
