/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// create namespace
if (typeof Mozilla == 'undefined') {
    var Mozilla = {};
}

;(function($, Mozilla) {
    'use strict';

    function BrowserTour (options) {

        this.options = {
            id: null,
            onTourComplete: null
        };

        if (typeof options === 'object') {
            for (var i in options) {
                if (options.hasOwnProperty(i)) {
                    this.options[i] = options[i];
                }
            }
        }

        // use all the flags!
        this.tourHasStarted = false;
        this.tourHasFinished = false;
        this.tourIsVisible = false;
        this.tourIsPostponed = false;
        this.tourIsAnimating = false;
        this.onTourCompleteHasFired = false;

        // set timeout for highlights
        this.highlightTimer = null;

        this.isLargeViewport = matchMedia('(min-width: 800px)');

        this.$body = $('body');
        this.$doc = $(document);
        this.$tour = $('#ui-tour').detach().show();
        this.$mask = $('#ui-tour-mask').detach().show();
        this.$maskInner = this.$mask.find('.mask-inner');

        this.$body.append(this.$mask).append(this.$tour);

        if (!this.options.allowScroll) {
            this.$body.addClass('noscroll');
        }

        this.$mask.focus();

        this.$tourList = $('.ui-tour-list');
        this.$prevButton = $('button.prev');
        this.$nextButton = $('button.next');
        this.$closeButton = $('button.close');
        this.$progress = $('.progress-step');
        this.$progressStep = this.$progress.find('.step');
        this.$progressMeter = this.$progress.find('.progress');
        this.$compactTitle = $('.compact-title');
        this.$tourTip = $('.tour-tip');
        this.$tourControls = $('.ui-tour-controls');
        this.$cta = $('.cta');
        this.$inTourLinks = this.$tourList.find('a.more');

        // bind UITour event listeners
        this.bindEvents();

        // bind resize handler to hide highlights at smaller viewports
        // as positioning can sometimes be incorrect (Bug 1091785)
        this.bindResize();
    }

    /*
     * Show the initial door-hanger menu that begins the tour
     * and display the 'splash screen' animation.
     */
    BrowserTour.prototype.init = function () {
        var that = this;
        var $p = this.$maskInner.find('p');
        var $main = this.$maskInner.find('.main');
        var words = $p.text().split(' ');
        var delay = $('body').hasClass('html-ltr') ? 100 : 0;
        var $tempEl = $('<div>');

        // wrap each word in a <span> with an incremental
        // transition-delay value.
        $p.empty().show();
        $.each(words, function(i, word) {
            var $span = $('<span>').text(word + ' ');
            $span.css({
                'transition-delay': (i * delay) + 'ms'
            });
            $tempEl.append($span);
        });
        $p.html($tempEl.html());

        setTimeout(function () {
            // animate the mask welcome message
            that.$maskInner.addClass('in');

            setTimeout(function () {
                $p.addClass('in');
            }, 1000);

            // show the door hanger if the tab is visible
            if (!document.hidden) {
                // trigger the door hanger for whatsnew
                $('.tour-init').trigger('tour-step');
            }

        }, 1000);

        // Register page id for Telemetry
        Mozilla.UITour.registerPageID(this.options.id);
    };

    /*
     * Bind custom events to handle calls to Mozilla.UITour
     * as well as regular event listeners for UI interaction
     */
    BrowserTour.prototype.bindEvents = function () {
        // door-hanger menu buttons
        var buttons = [
            {
                label: window.trans('later'),
                style: 'link',
                callback: this.postponeTour.bind(this)
            },
            {
                label: window.trans('start'),
                style: 'primary',
                callback: this.startTour.bind(this)
            }
        ];

        // callback to postpone tour if user clicks the (x) button
        var options = {
            closeButtonCallback: this.postponeTour.bind(this)
        };

        // show the door-hanger info panel
        $('.tour-init').on('tour-step', function () {
            var icon = Mozilla.ImageHelper.isHighDpi() ? this.dataset.iconHighRes : this.dataset.icon;

            Mozilla.UITour.showInfo(
                this.dataset.target,
                window.trans('title'),
                window.trans('text'),
                icon,
                buttons,
                options
            );
        });

        // show a hightlighted target feature in the browser UI
        $('.tour-highlight').on('tour-step', function () {
            Mozilla.UITour.showHighlight(this.dataset.target, this.dataset.effect);
        });

        // show a targeted menu panel in the browser UI
        $('.tour-menu').on('tour-step', function () {
            Mozilla.UITour.showMenu(this.dataset.target);
        });

        // 33.1 privacy tour 'forget' button doorhanger
        $('.tour-forget-widget').on('tour-step', this.highlightForgetButton.bind(this));

        // 33.1 privacy tour search engine highlight
        $('.tour-search-engine').on('tour-step', this.highlightSearchEngine);

        // handle page visibility changes to show the appropriate tour step
        this.$doc.on('visibilitychange', this.handleVisibilityChange.bind(this));

        // carousel event handlers
        this.$tour.on('transitionend', '.ui-tour-list li.current', this.onTourStep.bind(this));
        this.$closeButton.on('click', this.closeTour.bind(this));
        this.$mask.on('click', this.closeTour.bind(this));
        $('.cta button').on('click', this.startBrowsing.bind(this));
        $('button.step').on('click', this.onStepClick.bind(this));

        // show tooltips on prev/next buttons
        this.$tourControls.on('mouseenter focus', 'button.step', this.onStepHover.bind(this));
        this.$tourControls.on('mouseleave blur', 'button.step', this.offStepHover.bind(this));

        // alternate tour has in-step links to advance section
        this.$inTourLinks.on('click', this.onTourLinkClick.bind(this));

        // prevent focusing out of mask while initially visible
        this.$doc.on('focus.ui-tour', 'body', $.proxy(function(e) {
            if (!this.tourHasStarted && !this.$mask[0].contains(e.target)) {
                e.stopPropagation();
                this.$mask.focus();
            }
        }, this));

        // toggle floating signpost visibility when tabzilla opens / closes
        $('#tabzilla').on('click', this.toggleSignPost.bind(this));
        $(document).on('keydown', '#tabzilla-panel', $.proxy(function (event) {
            if (event.which === 27 && this.tourIsPostponed) {
                $('.floating-cta').fadeIn();
            }
        }, this));
    };

    /*
     * Hide UITour highlights if browser is resized < 900px as
     * a temp workaround for Bug 1091785
     */
    BrowserTour.prototype.bindResize = function () {
        var that = this;
        this.isLargeViewport.addListener(function (mq) {
            if (!mq.matches && that.tourIsVisible) {
                Mozilla.UITour.hideHighlight();
                Mozilla.UITour.hideInfo();
            } else if (mq.matches && that.tourIsVisible) {
                clearInterval(that.highlightTimer);
                that.highlightTimer = setTimeout(function () {
                    that.showHighlight();
                }, 900);
            }
        });
    };

    /*
     *Alternate version of the tour has in-step links to advance sections
     */
    BrowserTour.prototype.onTourLinkClick = function (e) {
        var $current = this.$tourList.find('li.current');
        var step = $current.data('step');
        e.preventDefault();

        if (this.tourIsAnimating || !this.tourIsVisible) {
            return;
        }

        this.$tour.focus();

        if ($current.is(':last-child')) {
            this.doCloseTour();
        } else {
            this.goToTourStep('next');
            step += 1;
            gaTrack(['_trackEvent', 'Tour Interaction', 'link click to', 'Step ' + step]);
        }
    };

    /*
     * Shows tooltips for next/prev steps when mouseenter or focus is applied to button
    */
    BrowserTour.prototype.onStepHover = function (e) {
        e.preventDefault();
        var $button = $(e.target);
        var $current = this.$tourList.find('li.current');
        var tipText;

        // if the tour is compact do nothing
        if ($button.hasClass('up')) {
            return;
        }

        tipText = $button.hasClass('prev') ? $current.data('tipPrev') : $current.data('tipNext');

        if (tipText) {
            this.$tourTip.html(tipText).addClass('show-tip');
        }
    };

    /*
     * Hide tooltips on mouseleave or blur
     */
    BrowserTour.prototype.offStepHover = function (e) {
        e.preventDefault();
        this.$tourTip.removeClass('show-tip');
    };

    /*
     * Postpone the tour until later.
     * Close the tour and display sign-post cta top right corner.
     */
    BrowserTour.prototype.postponeTour = function () {
        this.tourIsPostponed = true;
        var $cta = $('<button class="floating-cta"></button>');
        $cta.html(window.trans('laterCta'));
        this.$body.append($cta);
        $('.floating-cta').one('click', $.proxy(function (e) {
            e.preventDefault();
            this.restartTour();
            this.setCustomGAVariable();
            gaTrack(['_trackEvent', 'Tour Interaction', 'click', 'Signpost CTA']);
        }, this));

        this.doCloseTour();
        gaTrack(['_trackEvent', 'Tour Interaction', 'click', 'Not now']);
    };

    /*
     * Restarts the tour once postponed.
     * This can be called by an in-page cta or floating signpost cta
     */
    BrowserTour.prototype.restartTour = function () {
        var that = this;
        $('.floating-cta').fadeOut(function () {
            $(this).remove();
        });
        if (!this.tourHasStarted) {
            if (!this.options.allowScroll) {
                this.$body.addClass('noscroll');
            }

            this.$mask.show();
            setTimeout(function () {
                that.$mask.removeClass('out');
                that.startTour();
            }, 50);
        } else {
            this.expandTour();
        }

        if (typeof this.options.onRestartTour === 'function') {
            this.options.onRestartTour();
        }
    };

    /*
     * Toggles floating signpost cta visibility
     * Needed when Tabzilla opens/closes
     */
    BrowserTour.prototype.toggleSignPost = function () {
        var $cta = $('.floating-cta');
        if (this.tourIsPostponed) {
            if ($cta.is(':visible')) {
                $cta.fadeOut();
            } else if (!$cta.is(':visible')) {
                $cta.fadeIn();
            }
        }
    };

    /*
     * Updates the tour UI controls buttons to reflect the current step
     */
    BrowserTour.prototype.updateControls = function () {
        var $current = this.$tourList.find('li.current');

        this.$closeButton.removeAttr('disabled', 'disabled');

        // update prev/next button states
        if ($current.is(':first-child')) {
            this.$prevButton.attr('disabled', 'disabled').addClass('faded');
            this.$nextButton.removeAttr('disabled').removeClass('faded');
        } else if ($current.is(':last-child')) {
            this.$nextButton.attr('disabled', 'disabled').addClass('faded');
            this.$prevButton.removeAttr('disabled').removeClass('faded');
        } else {
            $('.ui-tour-controls button').removeAttr('disabled').removeClass('faded');
        }
    };

    /*
     * Show a doorhanger prompting to add 'forget' button to the toolbar
     */
    BrowserTour.prototype.highlightForgetButton = function () {
        var that = this;
        var targetIsAvailable = false;
        var $sequence = $('.tour-forget-widget');
        var $step;
        var buttons = [];
        var options;
        var icon = '';

        Mozilla.UITour.getConfiguration('availableTargets', function (config) {
            if (config.targets) {

                icon = Mozilla.ImageHelper.isHighDpi() ? $sequence.data('iconHighRes') : $sequence.data('icon');

                // find if user already has 'forget' button available
                $.each(config.targets, function(index, value) {
                    if (value === 'forget') {
                        targetIsAvailable = true;
                        return false;
                    }
                });

                // if not, show door-hanger prompting to add it
                if (!targetIsAvailable) {
                    $step = $sequence.find('.forget-hanger-1');

                    buttons = [
                        {
                            label: $step.data('buttonLater'),
                            style: 'link',
                            callback: that.laterForgetButton.bind(that)
                        },
                        {
                            label: $step.data('buttonAdd'),
                            style: 'primary',
                            callback: that.addForgetButton.bind(that)
                        }
                    ];

                    options = {
                        closeButtonCallback: that.closeForgetDoorhanger.bind(that),
                        targetCallback: that.closeForgetDoorhanger.bind(that)
                    };

                    // temp fix for Bug 1049130
                    Mozilla.UITour.showHighlight('appMenu', 'none');
                    Mozilla.UITour.showHighlight('appMenu', 'none');

                    Mozilla.UITour.showInfo(
                        'appMenu',
                        $step.data('title'),
                        $step.data('text'),
                        icon,
                        buttons,
                        options
                    );
                } else {
                    // else highlight the forget button with info panel
                    // $step = $sequence.find('.forget-hanger-2');

                    // options = {
                    //     closeButtonCallback: that.closeForgetDoorhanger.bind(that)
                    // };

                    // temp fix for Bug 1049130
                    Mozilla.UITour.showHighlight('forget', 'wobble');
                    Mozilla.UITour.showHighlight('forget', 'wobble');

                    // Mozilla.UITour.showInfo(
                    //     'forget',
                    //     $step.data('title'),
                    //     $step.data('text'),
                    //     icon,
                    //     buttons,
                    //     options
                    // );
                }
            }
        });
    };

    /*
     * Add the forget button to the user toolbar
     */
    BrowserTour.prototype.addForgetButton = function () {
        Mozilla.UITour.hideHighlight();
        Mozilla.UITour.addNavBarWidget('forget', this.highlightForgetButton.bind(this));
        gaTrack(['_trackEvent', 'Tour Interaction', 'Add it now', 'The new Forget Button']);
    };

    /*
     * Show doorhanger with instructions on how to add forget button at later date
     */
    BrowserTour.prototype.laterForgetButton = function () {
        var $sequence = $('.tour-forget-widget');
        var $step = $sequence.find('.forget-hanger-3');
        var icon = Mozilla.ImageHelper.isHighDpi() ? $sequence.data('iconHighRes') : $sequence.data('icon');
        var buttons = [];
        var options = {
            closeButtonCallback: this.closeForgetDoorhanger.bind(this),
            targetCallback: this.closeForgetDoorhanger.bind(this)
        };

        Mozilla.UITour.hideHighlight();
        Mozilla.UITour.showHighlight('appMenu', 'wobble');
        Mozilla.UITour.showInfo(
            'appMenu',
            $step.data('title'),
            $step.data('text'),
            icon,
            buttons,
            options
        );

        gaTrack(['_trackEvent', 'Tour Interaction', 'Later', 'The new Forget Button']);
    };

    /*
     * Close forget button doorhanger and remove highlight
     */
    BrowserTour.prototype.closeForgetDoorhanger = function () {
        Mozilla.UITour.hideHighlight();
        Mozilla.UITour.hideInfo();
    };

    /*
     * Open search engines menu if available and highlight a specified target
     */
    BrowserTour.prototype.highlightSearchEngine = function () {
        var target = this.dataset.target;
        Mozilla.UITour.getConfiguration('availableTargets', function (config) {
            var hasSearchBar;
            if (config.targets) {
                hasSearchBar = $.inArray('searchProvider', config.targets) !== -1;
                // if the searchEngine is available in the list, highlight it
                if (hasSearchBar && $.inArray(target, config.targets) !== -1) {
                    Mozilla.UITour.showMenu('searchEngines', function () {
                        Mozilla.UITour.showHighlight(target);
                    });
                // else just highlight the searchProvider drop-down
                } else if (hasSearchBar) {
                    Mozilla.UITour.showHighlight('searchProvider', 'wobble');
                }
            }
        });
    };

    /*
     * Shows current tour step highlight item
     */
    BrowserTour.prototype.showHighlight = function () {
        var $current = this.$tourList.find('li.current');
        var $stepTarget = $current.find('.step-target');
        var that = this;
        var target;

        // if the tab is not visible when event fires or viewport is too small
        // don't show the highlight step
        if (document.hidden || !this.isLargeViewport.matches) {
            return;
        }

        // if we're simply highlighting a target,
        // check it's availability in the UI first
        if ($stepTarget.hasClass('tour-highlight')) {

            Mozilla.UITour.getConfiguration('availableTargets', function (config) {

                target = $stepTarget.data('target');

                if (target && config.targets && $.inArray(target, config.targets) !== -1) {

                    // tour can force sticky menu between steps
                    // using conditional 'app-menu' class
                    if ($current.hasClass('app-menu')) {
                        Mozilla.UITour.showMenu('appMenu');
                    } else {
                        Mozilla.UITour.hideMenu('appMenu');
                    }

                    clearInterval(that.highlightTimer);
                    that.highlightTimer = setTimeout(function () {
                        $stepTarget.trigger('tour-step');
                    }, 200);
                }
            });
        // other UITour actions handle target availability checking
        // in their own 'tour-step' event handlers.
        // So just trigger the event.
        } else {
            clearInterval(this.highlightTimer);
            this.highlightTimer = setTimeout(function () {
                $stepTarget.trigger('tour-step');
            }, 200);
        }
    };

    /*
     * Triggers the current step tour highlight / interaction
     * Called on `transitionend` event after carousel item animates
     */
    BrowserTour.prototype.onTourStep = function (e) {
        if (e.originalEvent.propertyName === 'transform') {
            var $current = this.$tourList.find('li.current');
            var step = $current.data('step');
            var tipText;

            this.tourIsAnimating = false;
            this.showHighlight();

            this.$progressStep.html(window.trans('step' + step));
            this.$progressMeter.attr('aria-valuenow', step);
            this.$tourList.find('.tour-step').not('.current').removeClass('visible');

            // update the button states
            this.updateControls();

            // set focus on the header of current slide
            $current.find('h2').focus();

            if ($current.is(':last-child')) {
                // fire callback when reaching the last tour step.
                this.onTourComplete();
                // show green cta for the last step
                this.$cta.removeAttr('disabled').fadeIn();
            }

            // if user still has hover/focus over a button show the tooltip
            if ($('button.next:hover').length) {
                tipText = $current.data('tipNext');
                if (tipText) {
                    this.$tourTip.html(tipText);
                    this.$tourTip.addClass('show-tip');
                }
            } else if ($('button.prev:hover').length) {
                tipText = $current.data('tipPrev');
                if (tipText) {
                    this.$tourTip.html(tipText);
                    this.$tourTip.addClass('show-tip');
                }
            }
        }
    };

    /*
     * Tour navigation click handler
     */
    BrowserTour.prototype.onStepClick = function (e) {
        e.preventDefault();
        var $button = $(e.target);
        var $current = this.$tourList.find('li.current');
        var step = $current.data('step');

        // if the tour is compact do nothing
        // as uses it's own handler
        if ($button.hasClass('up')) {
            return;
        }

        var trans = $button.hasClass('prev') ? 'prev' : 'next';
        this.goToTourStep(trans);

        if (trans === 'prev') {
            step -= 1;
        } else {
            step += 1;
        }

        gaTrack(['_trackEvent', 'Tour Interaction', 'arrow click to', 'Step ' + step]);
    };

    /*
     * Transitions carousel animation to the next/prev step of the tour
     */
    BrowserTour.prototype.goToTourStep = function (trans) {
        var $current = this.$tourList.find('li.current');
        var $prev;
        var $next;

        if (!trans) {
            return;
        }

        this.tourIsAnimating = true;

        // hide any current highlights
        // or info panels
        clearInterval(this.highlightTimer);

        Mozilla.UITour.hideMenu('appMenu');
        Mozilla.UITour.hideInfo();
        Mozilla.UITour.hideHighlight();

        this.$tourTip.removeClass('show-tip');

        // disable tour control buttons while animating
        $('.ui-tour-controls button').attr('disabled', 'disabled');

        // if we're moving back from the last step, hide green cta
        if ($current.is(':last-child')) {
            this.$cta.attr('disabled', 'disabled').fadeOut();
        }

        // animate in/out the correct tour panel
        if (trans === 'prev') {
            $current.removeClass('current next-out').addClass('prev-out');
            $prev = $current.prev().addClass('visible');
            // slight delay is needed when animating an element
            // after applying display: block;
            setTimeout(function () {
                $prev.addClass('current');
            }, 50);

        } else if (trans === 'next') {
            $current.removeClass('current prev-out').addClass('next-out');
            $next = $current.next().addClass('visible');
            setTimeout(function () {
                $next.addClass('current');
            }, 50);
        }
    };

    /*
     * Go directly to a specific step in the tour. This can be called from
     * within the web page to go directly to a specific tour step.
     */
    BrowserTour.prototype.goToStep = function (step) {
        var $current = $('.ui-tour-list .tour-step[data-step="' + step + '"]');

        $('.ui-tour-list .tour-step.current').removeClass('current visible');
        $('.ui-tour-list .tour-step').removeClass('prev-out next-out');
        $current.addClass('current visible');
        $('.ui-tour-list .tour-step:gt(' + step + ')').addClass('prev-out');
        $('.ui-tour-list .tour-step:lt(' + step + ')').addClass('next-out');
        this.$progressStep.html(window.trans('step' + step));
        this.$progressMeter.attr('aria-valuenow', step);

        this.updateControls();
    };

    /*
     * Closes the browser tour when user clicks green cta button
     */
    BrowserTour.prototype.startBrowsing = function () {
        if (this.tourIsAnimating || !this.tourIsVisible) {
            return;
        }

        this.doCloseTour();
        gaTrack(['_trackEvent', 'Tour Interaction', 'button click', 'Start Browsing']);
    };

    /*
     * Determines whether tour should be minimized or closed completely
     */
    BrowserTour.prototype.closeTour = function () {
        var $current = this.$tourList.find('li.current');

        if (this.tourIsAnimating || !this.tourIsVisible) {
            return;
        }

        if ($current.is(':last-child')) {
            this.doCloseTour();
        } else {
            this.doCompactTour();
        }
    };

    /*
     * Closes the tour completely
     * Triggered on last step or if user presses esc key
     */
    BrowserTour.prototype.doCloseTour = function () {
        this.tourIsVisible = false;
        this.tourHasStarted = false;
        this.tourHasFinished = true;

        this.hideAnnotations();

        if (this.tourHasStarted) {
            gaTrack(['_trackEvent', 'Tour Interaction', 'click', 'Close tour']);
        }

        this.$cta.fadeOut('fast', $.proxy(function () {
            this.$tour.removeClass('in');
            this.$mask.addClass('out');
            setTimeout(this.onCloseTour.bind(this), 600);
        }, this));
    };

    BrowserTour.prototype.onCloseTour = function () {
        this.$mask.find('.mask-inner').addClass('out');
        this.$mask.hide();
        this.$body.removeClass('noscroll');
        // unbind ui-tour focus and keyboard event listeners
        this.$doc.off('.ui-tour').focus();
        this.$tour.off('.ui-tour');

        if (typeof this.options.onCloseTour === 'function') {
            this.options.onCloseTour();
        }
    };

    /*
     * Minimize the tour to compact state
     * Called when pressing the close button mid-way through the tour
     */
    BrowserTour.prototype.doCompactTour = function () {
        this.tourIsVisible = false;
        this.tourIsAnimating = true;

        this.hideAnnotations();

        this.$tour.removeClass('in').addClass('compact');
        this.$tour.attr('aria-expanded', false);

        // fade out the main modal content
        this.$tourList.fadeOut('fast');
        this.$progress.fadeOut('fast');
        this.$prevButton.fadeOut('fast');
        this.$closeButton.fadeOut('fast');

        // apply focus to the 'open' button once tour is compact.
        this.$nextButton.addClass('up').text(window.trans('open')).focus();
        this.$nextButton.off().on('click', this.expandTour.bind(this));

        // fade out the mask so user can interact with the page
        this.$mask.addClass('out');

        setTimeout(this.onCompactTour.bind(this), 600);

        gaTrack(['_trackEvent', 'Tour Interaction', 'click', 'Compact tour']);
    };

    BrowserTour.prototype.onCompactTour = function () {
        var title;
        title = this.$tourList.find('li.current h2').text();
        this.$mask.hide();
        this.$body.removeClass('noscroll');

        // fade in the compact modal content
        this.$compactTitle.html('<h2>' + title + '</h2>').fadeIn();
        this.$progress.addClass('compact').fadeIn($.proxy(function () {
            this.tourIsAnimating = false;
        }, this));

        if (typeof this.options.onCompactTour === 'function') {
            this.options.onCompactTour();
        }
    };

    /*
     * Expand tour from compact state and go back to the step
     * user was on on prior to minimizing the tour.
     */
    BrowserTour.prototype.expandTour = function () {
        var that = this;

        if (this.tourIsAnimating) {
            return;
        }

        this.tourIsVisible = true;
        this.tourIsAnimating = true;

        this.$tour.removeClass('compact').addClass('in').focus();
        this.$tour.attr('aria-expanded', true);
        this.$compactTitle.fadeOut('fast');
        this.$progress.fadeOut('fast');
        this.$prevButton.fadeIn('fast');
        this.$nextButton.off().on('click', this.onStepClick.bind(this));
        this.$nextButton.removeClass('up').text(window.trans('next'));
        this.$closeButton.fadeIn('fast');

        this.$mask.show();

        setTimeout(this.onTourExpand.bind(this), 600);

        setTimeout(function () {
            that.$mask.removeClass('out');
        }, 50);

        gaTrack(['_trackEvent', 'Tour Interaction', 'click', 'Expand tour']);
    };

    BrowserTour.prototype.onTourExpand = function () {
        if (!this.options.allowScroll) {
            this.$body.addClass('noscroll');
        }

        this.showHighlight();
        this.$progress.removeClass('compact').fadeIn('slow');
        this.$tourList.find('li.current').find('h2').focus();
        this.$tourList.fadeIn('slow', $.proxy(function () {
            this.tourIsAnimating = false;
        }, this));

        if (typeof this.options.onExpandTour === 'function') {
            this.options.onExpandTour();
        }
    };

    /*
     * Minimizes / closes the tour based on current step
     * Triggered when user presses the esc key
     */
    BrowserTour.prototype.onKeyUp = function (e) {
        var $current = this.$tourList.find('li.current');

        if (this.tourIsVisible && !this.tourIsAnimating) {

            switch (e.which) {
            // esc minimizes the tour
            case 27:
                this.closeTour();
                break;
            // left arrow key to previous step
            case 37:
                if (!$current.is(':first-child')) {
                    this.goToTourStep('prev');
                }
                break;
            // right arrow key to previous step
            case 39:
                if (!$current.is(':last-child')) {
                    this.goToTourStep('next');
                }
                break;
            }
        }
    };

    /*
     * Set custom GA variable so we know if the tour is taken for the first time
     * The custom var should only be set if cookies are enabled.
     */
    BrowserTour.prototype.setCustomGAVariable = function () {
        var firstTime = 'True';
        try {
            if (localStorage.getItem(this.options.id) === 'taken') {
                firstTime = 'False';
            } else {
                localStorage.setItem(this.options.id, 'taken');
            }
            gaTrack(['_setCustomVar', 5, 'First Time Taking Firefox Tour', firstTime, 2]);
        } catch (e) {}
    };

    /*
     * Starts the tour and animates the carousel up from bottom of viewport
     */
    BrowserTour.prototype.startTour = function () {
        this.updateControls();

        var that = this;
        var $current = this.$tourList.find('li.current');
        var step = $current.data('step');

        this.$progressStep.html(window.trans('step' + step));

        // fade out the inner mask messaging that's shown the the page loads
        this.$maskInner.addClass('out');

        this.$tour.addClass('in').focus();
        this.$tour.attr('aria-expanded', true);
        this.tourIsVisible = true;
        this.tourHasStarted = true;
        this.tourIsAnimating = true;

        Mozilla.UITour.hideInfo();

        // toggle/close with escape key
        this.$body.on('keyup.ui-tour', this.onKeyUp.bind(this));

        // prevent focusing out of modal while open
        this.$doc.off('focus.ui-tour', 'body').on('focus.ui-tour', 'body', function(e) {
            if (that.tourIsVisible && !that.$tour[0].contains(e.target)) {
                e.stopPropagation();
                that.$tour.focus();
            }
        });

        setTimeout(this.onStartTour.bind(this), 600);

        if (!this.tourIsPostponed) {
            this.setCustomGAVariable();
            gaTrack(['_trackEvent', 'Tour Interaction', 'click', 'Lets go']);
        } else {
            this.tourIsPostponed = false;
        }

    };

    /*
     * When the tour finishes animating in from bottom, trigger the tour step
     */
    BrowserTour.prototype.onStartTour = function () {
        var $current = this.$tourList.find('li.current');
        var that = this;
        $current.find('h2').focus();
        this.tourIsAnimating = false;
        this.highlightTimer = setTimeout(function () {
            that.showHighlight();
        }, 100);
    };

    /*
     * Fire an optional callback when the user reaches last step in the tour
     */
    BrowserTour.prototype.onTourComplete = function () {
        if (typeof this.options.onTourComplete === 'function' && !this.onTourCompleteHasFired) {
            this.options.onTourComplete();
            this.onTourCompleteHasFired = true;
        }
    };

    /*
     * Helper method to hide currently visible highlight annotations
     */
    BrowserTour.prototype.hideAnnotations = function () {
        clearInterval(this.highlightTimer);
        Mozilla.UITour.hideMenu('appMenu');
        Mozilla.UITour.hideHighlight();
        Mozilla.UITour.hideInfo();
    };

    /*
     * Handles page visibility changes if user leaves/returns to current tab.
     * Tour step UI highlights should hide when user leaves the tab, and appear
     * again when the user returns to the tab.
     */
    BrowserTour.prototype.handleVisibilityChange = function () {
        var $current = this.$tourList.find('li.current');
        var step = $current.data('step');
        var that = this;

        // if tab is hidden then hide all the UITour things.
        if (document.hidden) {
            this.hideAnnotations();

            if (this.tourIsVisible) {
                gaTrack(['_trackEvent', 'Tour Interaction', 'visibility', 'Leave tour']);
            }
        } else {
            // if tab is visible and tour is open, show the current step.
            if (this.tourIsVisible) {
                this.highlightTimer = setTimeout(function () {
                    if (that.tourIsVisible) {
                        that.showHighlight();
                        that.$progress.find('.step').html(window.trans('step' + step));
                        that.$progress.find('.progress').attr('aria-valuenow', step);
                    }
                }, 900);
                gaTrack(['_trackEvent', 'Tour Interaction', 'visibility', 'Return to tour']);
                // Update page id for Telemetry when returning to tab
                Mozilla.UITour.registerPageID(this.options.id);
            } else if (!this.tourHasStarted && !this.tourIsPostponed && !this.tourHasFinished) {
                // if tab is visible and tour has not yet started, show the door hanger.
                $('.tour-init').trigger('tour-step');
                // Register page id for Telemetry
                Mozilla.UITour.registerPageID(this.options.id);
            }
        }
    };

    window.Mozilla.BrowserTour = BrowserTour;

})(window.jQuery, window.Mozilla);
