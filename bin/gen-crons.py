#!/usr/bin/env python
import os
from optparse import OptionParser

from jinja2 import Template


HEADER = '!!AUTO-GENERATED!! Edit {template}.tmpl instead.'
TEMPLATE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'etc', 'cron.d'))


def main():
    parser = OptionParser()
    parser.add_option('-w', '--webapp',
                      help='Location of web app (required)')
    parser.add_option('-s', '--source',
                      help='Location of source for the web app (required)')
    parser.add_option('-t', '--template',
                      help='Name of the template (e.g. bedrock-prod)')
    parser.add_option('-u', '--user', default='root',
                      help=('Prefix cron with this user. '
                            'Only define for cron.d style crontabs.'))
    parser.add_option('-p', '--python', default='python2.6',
                      help='Python interpreter to use.')

    (opts, args) = parser.parse_args()

    if not opts.webapp:
        parser.error('-w must be defined')

    if not opts.template:
        parser.error('-t must be defined')

    django_manage = 'cd %s && %s manage.py' % (opts.webapp, opts.python)
    ctx = {
        'django_manage': django_manage,
        'django_cron': '%s cron' % django_manage,
    }

    for k, v in ctx.iteritems():
        ctx[k] = '%s %s' % (opts.user, v)

    # Needs to stay below the opts.user injection.
    ctx['user'] = opts.user
    ctx['webapp'] = opts.webapp
    ctx['source'] = opts.source
    ctx['python'] = opts.python
    ctx['header'] = HEADER.format(template=opts.template)

    tmpl_final_name = os.path.join(TEMPLATE_DIR, opts.template)
    tmpl_src_name = tmpl_final_name + '.tmpl'
    tmpl_temp_name = tmpl_final_name + '.TEMP'
    try:
        with open(tmpl_src_name, 'r') as src_fh:
            with open(tmpl_temp_name, 'w') as out_fh:
                out_fh.write(Template(src_fh.read()).render(**ctx))
    except IOError:
        parser.error('file must exist: ' + tmpl_src_name)

    # atomically move into place
    os.rename(tmpl_temp_name, tmpl_final_name)

if __name__ == '__main__':
    main()
